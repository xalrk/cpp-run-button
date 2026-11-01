'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const cpptools = require('./cpptools');

const TASK_TYPE = 'cppRunButton';
const TASK_SOURCE = 'C++ Run Button';

let extensionContext;

function activate(context) {
  extensionContext = context;
  context.subscriptions.push(
    vscode.commands.registerCommand('cppRunButton.run', buildAndRun)
  );
  // What vscode.extensions.getExtension(...).exports gives, for the tests.
  return { cpptools };
}

function deactivate() {}

// Counts clicks, so an older click that is still building can tell that a
// newer one has taken over and must not start its program.
let latestClick = 0;

// Compiles the file with the configured compiler, then runs the executable
// next to it. The result is returned so tests can check what happened.
async function buildAndRun(uri) {
  const click = ++latestClick;
  const document = await findDocument(uri);
  if (!document) {
    vscode.window.showErrorMessage('Open a C++ file to build and run it.');
    return { built: false };
  }
  if (document.isUntitled || document.uri.scheme !== 'file') {
    vscode.window.showWarningMessage('Save this file to disk before running it.');
    return { built: false };
  }
  if (document.isDirty && !(await document.save())) {
    return { built: false };
  }
  // Not awaited: the build goes ahead while the question is showing.
  cpptools.offerToHideRunButton(extensionContext, document.uri).catch(() => {});

  const file = document.uri.fsPath;
  const dir = path.dirname(file);
  const name = path.parse(file).name;
  const exe = path.join(dir, process.platform === 'win32' ? `${name}.exe` : name);

  const config = vscode.workspace.getConfiguration('cppRunButton', document.uri);
  const compiler = findCompiler(config, document.uri);
  if (!compiler) {
    return { built: false };
  }
  // Other source files the program needs: the ones that go with the headers
  // it includes, plus any the user listed.
  const found = config.get('followIncludes', true)
    ? findIncludedSources(file)
    : { sources: [], visited: [] };
  const extra = config.get('extraSources', []).map((p) => path.resolve(dir, p));
  const sources = [...new Set([...found.sources, ...extra])].filter((s) => !samePath(s, file));
  if (!(await saveDirty([...found.visited, ...sources]))) {
    return { built: false };
  }
  const args = [...config.get('compilerArgs', []), file, ...sources, '-o', exe];
  const scope = vscode.workspace.getWorkspaceFolder(document.uri) || vscode.TaskScope.Workspace;

  // A program still waiting for input would keep its terminal busy, and on
  // Windows it would lock the .exe we are about to overwrite.
  await stopRunningTasks();

  // With no folder open the editor refuses to start a task terminal anywhere
  // but the home folder (https://github.com/microsoft/vscode/issues/293399),
  // and leaving cwd out makes it look for a workspace folder that isn't there.
  // So both steps start in the home folder: the compiler gets absolute paths
  // and doesn't care, and the program is started through run-in-dir.js,
  // which moves into the file's folder first.
  const noFolderOpen = !vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0;
  const cwdOptions = { cwd: noFolderOpen ? os.homedir() : dir };

  const build = await runTask(
    { type: TASK_TYPE, step: 'build', file },
    scope,
    new vscode.ProcessExecution(compiler, args, cwdOptions),
    { clear: config.get('clearTerminal', true), focus: false, echo: true }
  );
  if (!build.started) {
    vscode.window.showErrorMessage(`Couldn't start the compiler "${compiler}".`);
    return { built: false };
  }
  if (build.exitCode !== 0) {
    return { built: false, exitCode: build.exitCode };
  }
  if (click !== latestClick) {
    return { built: true };
  }

  const execution = noFolderOpen
    ? new vscode.ProcessExecution(process.execPath, [path.join(__dirname, 'run-in-dir.js'), dir, exe], {
      ...cwdOptions,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
    : new vscode.ProcessExecution(exe, [], cwdOptions);
  // The build step already echoed what is going on, and in the no-folder case
  // the command line would only show the editor's own executable. It shares
  // the build's terminal, so clearing there (cppRunButton.clearTerminal)
  // already covers this step.
  const run = await runTask(
    { type: TASK_TYPE, step: 'run', file },
    scope,
    execution,
    { clear: false, focus: true, echo: false }
  );
  return { built: true, exitCode: run.exitCode };
}

// The compiler to use: the cppRunButton.compiler setting if the user set it,
// otherwise g++ from PATH, otherwise the compiler Microsoft C/C++ is set up
// with. Checked up front because a task whose program doesn't exist never
// reports that it ended. Shows an error and returns undefined if none is found.
function findCompiler(config, uri) {
  const setting = config.inspect('compiler') || {};
  const chosen = [setting.workspaceFolderValue, setting.workspaceValue, setting.globalValue].find(Boolean);
  if (chosen) {
    if (findExecutable(chosen)) return chosen;
    vscode.window.showErrorMessage(
      `Couldn't find the compiler "${chosen}" set in "cppRunButton.compiler". ` +
        'Check that it is installed, and use its full path if it is not on your PATH.'
    );
    return undefined;
  }

  if (findExecutable('g++')) return 'g++';
  const configured = cpptools.configuredCompiler(uri);
  if (configured && findExecutable(configured)) return configured;

  vscode.window.showErrorMessage(
    'Couldn\'t find g++. Install it and make sure it is on your PATH, ' +
      'or set "cppRunButton.compiler" to the full path of your compiler.'
  );
  return undefined;
}

const SOURCE_EXTENSIONS = ['.cpp', '.cc', '.cxx'];

// The source files that go with the headers a file includes. For each
// #include "foo.h" (looked up from the including file's folder), foo.cpp,
// foo.cc or foo.cxx next to the header is added to the build, and the search
// continues through that header and source, so main -> a.h -> b.h is followed
// all the way. A file that is itself #included somewhere (the
// `#include "stack.cpp"` pattern for templates) is left out, since compiling it
// again on its own would define everything twice.
//
// Returns { sources, visited }: visited is every file read on the way, so
// their unsaved edits can be saved before the build.
function findIncludedSources(file) {
  const seen = new Set([file]);
  const included = new Set();
  const sources = [];
  const queue = [file];
  const visit = (p) => {
    if (seen.has(p) || !fs.existsSync(p)) return false;
    seen.add(p);
    queue.push(p);
    return true;
  };
  while (queue.length) {
    const current = queue.pop();
    const text = readCurrent(current);
    if (text === undefined) continue;
    for (const match of text.matchAll(/^\s*#\s*include\s*"([^"]+)"/gm)) {
      const header = path.resolve(path.dirname(current), match[1]);
      included.add(header);
      visit(header); // headers can include other headers
      const base = header.replace(/\.(h|hpp|hh|hxx)$/i, '');
      if (base === header) continue; // not a header, e.g. #include "impl.cpp"
      // Only the first match, so foo.cpp and a stray foo.cc aren't both linked.
      const source = SOURCE_EXTENSIONS.map((ext) => base + ext).find((s) => fs.existsSync(s));
      if (source && visit(source)) sources.push(source);
    }
  }
  return { sources: sources.filter((s) => !included.has(s)), visited: [...seen] };
}

// A file's text as the editor has it, so includes added but not yet saved
// count too, or else as it is on disk.
function readCurrent(file) {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && samePath(d.uri.fsPath, file));
  if (open) return open.getText();
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function samePath(a, b) {
  const norm = (p) => (process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p));
  return norm(a) === norm(b);
}

// Saves unsaved edits in these files, so the build doesn't compile stale
// copies. Only these, not everything that is open. False if a save failed.
async function saveDirty(files) {
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.isDirty && doc.uri.scheme === 'file' && files.some((f) => samePath(f, doc.uri.fsPath))) {
      if (!(await doc.save())) return false;
    }
  }
  return true;
}

async function findDocument(uri) {
  if (uri instanceof vscode.Uri) {
    return vscode.workspace.openTextDocument(uri);
  }
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.languageId === 'cpp') {
    return editor.document;
  }
  return undefined;
}

// Looks a command up the way the OS would: a path is checked directly, a bare
// name is searched for on PATH (with PATHEXT extensions on Windows).
function findExecutable(command) {
  const isFile = (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  const extensions = process.platform === 'win32'
    ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')]
    : [''];
  const candidates = command.includes('/') || command.includes(path.sep)
    ? [command]
    : (process.env.PATH || '').split(path.delimiter).filter(Boolean).map((d) => path.join(d, command));
  for (const candidate of candidates) {
    const found = extensions.map((ext) => candidate + ext).find(isFile);
    if (found) return found;
  }
  return undefined;
}

let nextTaskId = 1;

// Runs one task and resolves when it ends. Tasks are matched by an id in
// their definition rather than by TaskExecution, since the end events can
// arrive before executeTask() resolves for a process that exits immediately.
function runTask(definition, scope, execution, { clear, focus, echo }) {
  const id = nextTaskId++;
  const task = new vscode.Task({ ...definition, id }, scope, definition.step, TASK_SOURCE, execution, []);
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
    showReuseMessage: false,
    echo,
    clear,
    focus,
  };

  const isOurs = (e) =>
    e.execution.task.definition.type === TASK_TYPE && e.execution.task.definition.id === id;

  return new Promise((resolve, reject) => {
    let started = false;
    let exitCode;
    const subscriptions = [
      // A process that fails to launch still gets a start event, just
      // without a process id.
      vscode.tasks.onDidStartTaskProcess((e) => {
        if (isOurs(e) && e.processId !== undefined) started = true;
      }),
      vscode.tasks.onDidEndTaskProcess((e) => {
        if (isOurs(e)) exitCode = e.exitCode;
      }),
      vscode.tasks.onDidEndTask((e) => {
        if (!isOurs(e)) return;
        subscriptions.forEach((s) => s.dispose());
        resolve({ started, exitCode });
      }),
    ];
    vscode.tasks.executeTask(task).then(undefined, (err) => {
      subscriptions.forEach((s) => s.dispose());
      reject(err);
    });
  });
}

// Stops our tasks that are still running and resolves once they have ended.
//
// tasks.taskExecutions lists a task as soon as it is requested, but a
// terminate() sent before the task has really started is silently ignored,
// so it is repeated until the end event arrives. The end events are counted
// rather than polling tasks.taskExecutions, which still lists a task while
// its end event is being delivered.
function stopRunningTasks() {
  const running = vscode.tasks.taskExecutions.filter((e) => e.task.definition.type === TASK_TYPE);
  if (running.length === 0) return Promise.resolve();

  return new Promise((resolve) => {
    const ended = new Set();
    const done = () => {
      subscription.dispose();
      clearInterval(retry);
      clearTimeout(giveUp);
      resolve();
    };
    const subscription = vscode.tasks.onDidEndTask((e) => {
      if (e.execution.task.definition.type !== TASK_TYPE) return;
      ended.add(e.execution.task.definition.id);
      if (running.every((r) => ended.has(r.task.definition.id))) done();
    });
    const terminate = () => running
      .filter((r) => !ended.has(r.task.definition.id))
      .forEach((r) => r.terminate());
    const retry = setInterval(terminate, 250);
    // Never leave the button stuck if an end event goes missing.
    const giveUp = setTimeout(done, 5000);
    terminate();
  });
}

module.exports = { activate, deactivate };
