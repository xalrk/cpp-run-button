'use strict';

// Loaded by the editor through --extensionTestsPath. Uses node:assert only,
// so the project stays free of npm dependencies.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const dir = process.env.CPP_RUN_TEST_DIR;
const folderOpen = Boolean(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length);
const hasCpptools = Boolean(vscode.extensions.getExtension('ms-vscode.cpptools'));

// Thrown by a test that doesn't apply to this editor setup.
class Skip extends Error {}

function extension() {
  return vscode.extensions.getExtension('xalrk.cpp-run-button').exports;
}

function write(name, source) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return file;
}

async function open(file) {
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  return document;
}

function runButton() {
  return vscode.commands.executeCommand('cppRunButton.run');
}

// Answers the "hide Microsoft's Run button" question with `answer` and
// records each time it is asked. Starts a fresh editor session for it.
function answerCpptoolsQuestion(answer) {
  const { cpptools } = extension();
  const calls = [];
  cpptools.ui.ask = async (message, ...items) => {
    calls.push({ message, items });
    return answer;
  };
  cpptools.session.asked = false;
  return calls;
}

function findOnPath(name) {
  return (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, name)).find((p) => fs.existsSync(p));
}

// Runs the button with g++ hidden from the extension's PATH lookup, and
// returns the result along with the compiler the build step ran.
async function runWithoutGxxOnPath() {
  let compiler;
  const subscription = vscode.tasks.onDidStartTask((e) => {
    if (e.execution.task.definition.step === 'build') compiler = e.execution.task.execution.process;
  });
  const savedPath = process.env.PATH;
  process.env.PATH = '';
  try {
    return { result: await runButton(), compiler };
  } finally {
    process.env.PATH = savedPath;
    subscription.dispose();
  }
}

function waitFor(condition, timeout = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(timer);
        reject(new Error('timed out'));
      }
    }, 100);
  });
}

const tests = {
  async 'builds, runs in the file\'s folder and reports the exit code'() {
    const file = write('hello.cpp', [
      '#include <fstream>',
      'int main() { std::ofstream("ran.txt") << "ok"; return 3; }',
      '',
    ].join('\n'));
    await open(file);
    assert.deepStrictEqual(await runButton(), { built: true, exitCode: 3 });
    assert.strictEqual(fs.readFileSync(path.join(dir, 'ran.txt'), 'utf8'), 'ok');
    const exe = process.platform === 'win32' ? 'hello.exe' : 'hello';
    assert.ok(fs.existsSync(path.join(dir, exe)), 'executable sits next to the source');
  },

  async 'saves unsaved edits before building'() {
    const file = write('edited.cpp', 'int main() { return 1; }\n');
    const document = await open(file);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, document.lineAt(0).range, 'int main() { return 4; }');
    await vscode.workspace.applyEdit(edit);
    assert.ok(document.isDirty);
    assert.deepStrictEqual(await runButton(), { built: true, exitCode: 4 });
    assert.ok(!document.isDirty);
  },

  async 'handles spaces in the path'() {
    const file = write(path.join('my folder', 'with space.cpp'), 'int main() { return 5; }\n');
    await open(file);
    assert.deepStrictEqual(await runButton(), { built: true, exitCode: 5 });
  },

  async 'does not run anything when compilation fails'() {
    const file = write('broken.cpp', 'int main() { return oops; }\n');
    await open(file);
    const result = await runButton();
    assert.strictEqual(result.built, false);
    assert.notStrictEqual(result.exitCode, 0);
    assert.ok(!fs.existsSync(path.join(dir, 'broken')) && !fs.existsSync(path.join(dir, 'broken.exe')));
  },

  async 'passes compilerArgs to the compiler'() {
    const config = vscode.workspace.getConfiguration('cppRunButton');
    await config.update('compilerArgs', ['-DANSWER=6'], vscode.ConfigurationTarget.Global);
    try {
      const file = write('defines.cpp', 'int main() { return ANSWER; }\n');
      await open(file);
      assert.deepStrictEqual(await runButton(), { built: true, exitCode: 6 });
    } finally {
      await config.update('compilerArgs', undefined, vscode.ConfigurationTarget.Global);
    }
  },

  async 'clears the terminal unless clearTerminal is off'() {
    const cleared = [];
    const subscription = vscode.tasks.onDidStartTask((e) => {
      if (e.execution.task.definition.step === 'build') cleared.push(e.execution.task.presentationOptions.clear);
    });
    const config = vscode.workspace.getConfiguration('cppRunButton');
    try {
      await open(write('clear.cpp', 'int main() { return 0; }\n'));
      await runButton();
      await config.update('clearTerminal', false, vscode.ConfigurationTarget.Global);
      await runButton();
      assert.deepStrictEqual(cleared, [true, false]);
    } finally {
      subscription.dispose();
      await config.update('clearTerminal', undefined, vscode.ConfigurationTarget.Global);
    }
  },

  async 'reports a compiler that cannot be started'() {
    const config = vscode.workspace.getConfiguration('cppRunButton');
    await config.update('compiler', 'no-such-compiler-xyz', vscode.ConfigurationTarget.Global);
    try {
      await open(write('no-compiler.cpp', 'int main() { return 0; }\n'));
      assert.deepStrictEqual(await runButton(), { built: false });
    } finally {
      await config.update('compiler', undefined, vscode.ConfigurationTarget.Global);
    }
  },

  async 'passes what you type in the terminal to the program'() {
    const file = write('echo.cpp', '#include <iostream>\nint main() { int x; std::cin >> x; return x * 2; }\n');
    await open(file);
    const running = runButton();
    await waitFor(() => vscode.tasks.taskExecutions.some(
      (e) => e.task.definition.type === 'cppRunButton' && e.task.definition.step === 'run'
    ));
    // Give the program a moment to start reading before typing into it.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    vscode.window.activeTerminal.sendText('21');
    assert.deepStrictEqual(await running, { built: true, exitCode: 42 });
  },

  async 'a quick second click wins and the first one runs nothing'() {
    const file = write('twice.cpp', '#include <fstream>\nint main() { std::ofstream("count.txt", std::ios::app) << "x"; return 8; }\n');
    await open(file);
    const first = runButton();
    const second = runButton();
    assert.deepStrictEqual(await second, { built: true, exitCode: 8 });
    const firstResult = await first;
    assert.strictEqual(firstResult.exitCode, undefined);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'count.txt'), 'utf8'), 'x');
  },

  async 'clicking again stops a program that is still waiting for input'() {
    const waiting = write('waits.cpp', '#include <iostream>\nint main() { int x; std::cin >> x; return 0; }\n');
    await open(waiting);
    const first = runButton();
    await waitFor(() => vscode.tasks.taskExecutions.some(
      (e) => e.task.definition.type === 'cppRunButton' && e.task.definition.step === 'run'
    ));
    await open(write('after.cpp', 'int main() { return 7; }\n'));
    assert.deepStrictEqual(await runButton(), { built: true, exitCode: 7 });
    const firstResult = await first;
    assert.strictEqual(firstResult.built, true);
    assert.notStrictEqual(firstResult.exitCode, 0);
  },
};


Object.assign(tests, {
  async 'turns C compiler paths into the matching C++ driver'() {
    const { cxxDriver } = extension().cpptools;
    const cases = [
      ['/usr/bin/gcc', path.join('/usr/bin', 'g++')],
      ['/usr/bin/g++', path.join('/usr/bin', 'g++')],
      ['/usr/bin/clang-18', path.join('/usr/bin', 'clang++-18')],
      ['/usr/bin/cc', path.join('/usr/bin', 'c++')],
      ['/opt/mingw/bin/x86_64-w64-mingw32-gcc', path.join('/opt/mingw/bin', 'x86_64-w64-mingw32-g++')],
      ['C:/msys64/ucrt64/bin/gcc.exe', path.join('C:/msys64/ucrt64/bin', 'g++.exe')],
      ['C:/VS/bin/Hostx64/x64/cl.exe', undefined],
      ['', undefined],
      [null, undefined],
    ];
    for (const [input, expected] of cases) assert.strictEqual(cxxDriver(input), expected, String(input));
  },

  async 'reads c_cpp_properties.json with comments and trailing commas'() {
    const { parseJsonc } = extension().cpptools;
    const text = '{\n  // a comment\n  "url": "http://example.com", /* another */\n' +
      '  "list": [1, 2,],\n  "tricky": "a \\" ,] // b",\n}\n';
    assert.deepStrictEqual(parseJsonc(text), { url: 'http://example.com', list: [1, 2], tricky: 'a " ,] // b' });
  },

  async 'uses the compiler from c_cpp_properties.json when g++ is not on PATH'() {
    if (!folderOpen) throw new Skip('needs a folder open');
    const gcc = findOnPath('gcc');
    const name = { linux: 'Linux', darwin: 'Mac', win32: 'Win32' }[process.platform];
    write(path.join('.vscode', 'c_cpp_properties.json'), [
      '{',
      '  // Written by Microsoft C/C++',
      '  "configurations": [',
      `    { "name": "${name}", "compilerPath": ${JSON.stringify(gcc)}, },`,
      '  ],',
      '  "version": 4',
      '}',
    ].join('\n'));
    try {
      await open(write('props.cpp', 'int main() { return 9; }\n'));
      const { result, compiler } = await runWithoutGxxOnPath();
      assert.deepStrictEqual(result, { built: true, exitCode: 9 });
      assert.strictEqual(compiler, path.join(path.dirname(gcc), 'g++'));
    } finally {
      fs.rmSync(path.join(dir, '.vscode'), { recursive: true, force: true });
    }
  },

  async 'uses C_Cpp.default.compilerPath when g++ is not on PATH'() {
    if (!hasCpptools) throw new Skip('needs Microsoft C/C++');
    const gcc = findOnPath('gcc');
    const config = vscode.workspace.getConfiguration('C_Cpp');
    await config.update('default.compilerPath', gcc, vscode.ConfigurationTarget.Global);
    try {
      await open(write('default-path.cpp', 'int main() { return 10; }\n'));
      const { result, compiler } = await runWithoutGxxOnPath();
      assert.deepStrictEqual(result, { built: true, exitCode: 10 });
      assert.strictEqual(compiler, path.join(path.dirname(gcc), 'g++'));
    } finally {
      await config.update('default.compilerPath', undefined, vscode.ConfigurationTarget.Global);
    }
  },

  async 'does not ask about Microsoft\'s Run button when it is not installed'() {
    if (hasCpptools) throw new Skip('Microsoft C/C++ is installed');
    const calls = answerCpptoolsQuestion('Hide it');
    await open(write('no-cpptools.cpp', 'int main() { return 0; }\n'));
    assert.deepStrictEqual(await runButton(), { built: true, exitCode: 0 });
    assert.strictEqual(calls.length, 0);
  },

  async '"Keep both" leaves Microsoft\'s Run button and asks again next session'() {
    if (!hasCpptools) throw new Skip('needs Microsoft C/C++');
    const calls = answerCpptoolsQuestion('Keep both');
    await open(write('keep.cpp', 'int main() { return 0; }\n'));
    await runButton();
    await runButton();
    assert.strictEqual(calls.length, 1, 'asked once per session');
    assert.match(calls[0].message, /Microsoft C\/C\+\+ also shows a Run button/);
    assert.deepStrictEqual(calls[0].items, ['Hide it', 'Keep both', "Don't ask again"]);
    assert.strictEqual(vscode.workspace.getConfiguration('C_Cpp').get('debugShortcut'), true);
    extension().cpptools.session.asked = false;
    await runButton();
    assert.strictEqual(calls.length, 2, 'asked again in a new session');
  },

  async '"Hide it" turns off Microsoft\'s Run button and is remembered'() {
    if (!hasCpptools) throw new Skip('needs Microsoft C/C++');
    const config = () => vscode.workspace.getConfiguration('C_Cpp');
    const calls = answerCpptoolsQuestion('Hide it');
    try {
      await open(write('hide.cpp', 'int main() { return 0; }\n'));
      await runButton();
      await waitFor(() => config().get('debugShortcut') === false);
      assert.strictEqual(config().inspect('debugShortcut').globalValue, false);
      // Turning it back on later must not bring the question back.
      await config().update('debugShortcut', undefined, vscode.ConfigurationTarget.Global);
      extension().cpptools.session.asked = false;
      await runButton();
      assert.strictEqual(calls.length, 1);
    } finally {
      await config().update('debugShortcut', undefined, vscode.ConfigurationTarget.Global);
    }
  },
});

async function run() {
  await vscode.extensions.getExtension('xalrk.cpp-run-button').activate();
  // No real notifications: tests that care about the question set their own.
  answerCpptoolsQuestion(undefined);
  const results = [];
  const only = process.env.CPP_RUN_TEST_GREP;
  for (const [name, test] of Object.entries(tests)) {
    if (only && !new RegExp(only).test(name)) continue;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out after 60 s')), 60000);
    });
    try {
      await Promise.race([test(), timeout]);
      results.push({ name });
    } catch (err) {
      results.push(err instanceof Skip
        ? { name, skipped: err.message }
        : { name, error: String(err && err.stack ? err.stack : err) });
    } finally {
      clearTimeout(timer);
    }
    // The editor's console output doesn't reliably reach the terminal, so the
    // results go to a file that test/runTest.js prints. It is rewritten after
    // every test so a hang still leaves a record of how far it got.
    fs.writeFileSync(process.env.CPP_RUN_TEST_RESULTS, JSON.stringify(results));
  }
  const failures = results.filter((r) => r.error).length;
  if (failures) throw new Error(`${failures} test(s) failed`);
}

module.exports = { run };
