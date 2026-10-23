# C++ Run Button

A ▶ button in the editor title bar that compiles the C++ file you have open and runs it. Clicking it does the
same as typing these two commands in the file's folder:

```sh
g++ hello.cpp -o hello
./hello
```

(On native Windows, i.e. without WSL, the program is `hello.exe`, and the button runs it the same way.)

It works in VS Code and VSCodium, on Linux, macOS and Windows, and inside WSL.

![The ▶ button in the editor's top right corner, and a program that asked for a name running in the terminal panel](images/screenshot.png)

## Features

- **One click:** saves the file, compiles it, and runs the program if it compiled.
- **Interactive:** the program runs in the terminal panel, so `std::cin` works and you can type input.
- **The program runs from the file's folder**, so relative paths like `std::ifstream("input.txt")` open files next
  to your source, even when you opened just the file and no folder.
- **Click again to restart:** a program still waiting for input is stopped before the new build starts.
- **Keep earlier output if you want:** each click clears the terminal by default; set
  `cppRunButton.clearTerminal` to `false` to keep previous runs' output above the new one.
- **No dependencies:** nothing to install besides a compiler, and no shell commands, so file names with spaces
  are fine.
- **Gets along with Microsoft's C/C++ extension:** uses the compiler it is set up with, and offers to hide its
  second Run button (see [below](#microsofts-cc-extension)).

## Requirements

You need a C++ compiler that the extension can find: `g++` on your `PATH`, or the compiler you set up in
Microsoft's C/C++ extension, or any compiler you name in the `cppRunButton.compiler` setting. The compiler must
run on the same system as the editor's extensions: on native Windows that means a Windows build of `g++`, and in
WSL a Linux one.

If you already have a compiler, skip ahead to [Installing](#installing): open a terminal, run `g++ --version`,
and if it prints a version you are set. Otherwise pick the section below that matches how you use the editor.

### Linux

Install `g++` from your distribution:

```sh
sudo apt install g++          # Debian, Ubuntu, Mint
sudo dnf install gcc-c++      # Fedora
sudo pacman -S gcc            # Arch
```

Then open a new terminal and check with `g++ --version`.

### macOS

Install Apple's command line tools, which include `g++` (it is Clang under the hood, which is fine):

```sh
xcode-select --install
```

Then open a new terminal and check with `g++ --version`.

### Windows (native, without WSL)

The extension runs on Windows itself and needs a Windows build of `g++`. The easiest way to get one is the
MinGW-w64 toolchain from [MSYS2](https://www.msys2.org/):

1. Download and run the MSYS2 installer. Keep the default folder, `C:\msys64`.
2. In the **MSYS2 UCRT64** terminal it opens at the end (also in the Start menu), install the compiler:

   ```sh
   pacman -S mingw-w64-ucrt-x86_64-gcc
   ```

3. Add `C:\msys64\ucrt64\bin` to your `PATH`: open the Start menu, search for **Edit environment variables for
   your account**, select **Path**, click **Edit** then **New**, and paste the folder.
4. Restart VS Code (close all its windows) so it picks up the new `PATH`, then check in its terminal panel with
   `g++ --version`.

Notes:

- If you already set up Microsoft's C/C++ extension with a MinGW `g++`, you can skip step 3: when `g++` isn't on
  your `PATH`, the ▶ button uses the compiler from that extension's settings.
- Visual Studio's compiler (`cl.exe`) isn't supported.
- A `g++` installed inside WSL (with `apt`) can't be used from native Windows. If that is where your compiler is,
  use the next section instead.

### Windows with WSL

If your code and compiler live in WSL, open the folder in WSL rather than in Windows, and everything works like
on Linux:

1. Install Microsoft's [WSL extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-wsl)
   in VS Code.
2. Open your folder in WSL: run `code .` from a WSL terminal, or use **WSL: Connect to WSL** from the Command
   Palette. The window's bottom left corner then shows **WSL: Ubuntu** (or your distribution's name).
3. Install `g++` in WSL, in its terminal: `sudo apt install g++` (Ubuntu and Debian), then check with
   `g++ --version`.
4. Install C++ Run Button while connected to WSL (see [Installing](#installing)). Extensions are installed per
   system, so an install done in a native Windows window doesn't show up in WSL windows, and the other way round.

In WSL the program is `hello`, not `hello.exe`, and the Linux instructions apply throughout this README.

## Installing

1. Download `cpp-run-button-<version>.vsix` from the [releases page](https://github.com/xalrk/cpp-run-button/releases).
2. In the editor, open the Command Palette (`Ctrl+Shift+P`, or `Cmd+Shift+P` on macOS), run
   **Extensions: Install from VSIX...** and pick the file.

If you work in WSL, do this in a window that is connected to WSL, so the extension is installed there.

## Usage

Open a `.cpp` file and click ▶ in the top right corner of the editor, or run **C++: Build and Run C++ File** from
the Command Palette. The compiler's messages and your program's output appear in the terminal panel. If the build
fails, nothing is run.

To give it a keyboard shortcut, open **Preferences: Open Keyboard Shortcuts**, search for
`cppRunButton.run` and pick a key.

The executable is written next to the source file: `hello` on Linux, macOS and WSL, `hello.exe` on native Windows. You
may want to add these to your `.gitignore`.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `cppRunButton.compiler` | `""` | Compiler to run: a name on your `PATH` (`g++`, `clang++`) or a full path, e.g. `C:\msys64\ucrt64\bin\g++.exe`. When empty, `g++` from your `PATH` is used, or else the compiler set up in Microsoft's C/C++ extension. |
| `cppRunButton.compilerArgs` | `[]` | Extra arguments placed before the file name, e.g. `["-std=c++20", "-Wall", "-O2"]`. |
| `cppRunButton.clearTerminal` | `true` | Clear the terminal on each click, so it shows only the latest build and run. Set to `false` to keep the output of earlier runs above it. |

Each file is compiled on its own. For projects with several `.cpp` files, use a build system such as CMake.

## Microsoft's C/C++ extension

Many people have Microsoft's [C/C++ extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools)
installed. C++ Run Button works alongside it:

- **Compiler:** if `g++` isn't on your `PATH`, the compiler from its settings is used: the `compilerPath` in your
  folder's `.vscode/c_cpp_properties.json`, then `C_Cpp.default.compilerPath`. A C compiler there is swapped for
  the C++ one next to it (`gcc` → `g++`, `clang` → `clang++`). MSVC's `cl.exe` isn't supported.
- **Two Run buttons:** Microsoft's extension adds its own Run/Debug button to the title bar. The first time you
  click ▶ while both are showing, you are asked whether to hide Microsoft's. **Hide it** turns off its
  `C_Cpp.debugShortcut` setting, which also hides its "Add Debug Configuration" ⚙ button; set it back to `true`
  to bring them back. **Keep both** asks again next time you open the editor, and **Don't ask again** doesn't.
  Debugging is still available from the Run and Debug view.

## Restricted Mode

Building and running code is turned off in folders you haven't trusted (VS Code's
[Workspace Trust](https://code.visualstudio.com/docs/editor/workspace-trust)), because compiling and running
someone else's code is not safe.

## Building from source

The extension has no npm dependencies, and neither does packaging it:

```sh
node scripts/package.js          # writes cpp-run-button-<version>.vsix
```

The tests run inside a real editor, once with a folder open and once with loose files. They need `g++` and a
desktop session, and `VSCODE_BIN` must point at the editor's main executable (not the `bin/code` or
`bin/codium` launcher script, which exits without waiting for the tests):

```sh
VSCODE_BIN=/path/to/VSCodium-linux-x64/codium node test/runTest.js
```

To also run them next to Microsoft's C/C++ extension, which only works in Microsoft's VS Code, install it into
a separate extensions folder and point the tests at both:

```sh
/path/to/VSCode-linux-x64/bin/code --extensions-dir /tmp/cpptools-ext --install-extension ms-vscode.cpptools
CPPTOOLS_VSCODE_BIN=/path/to/VSCode-linux-x64/code CPPTOOLS_EXTENSIONS_DIR=/tmp/cpptools-ext \
  VSCODE_BIN=/path/to/VSCodium-linux-x64/codium node test/runTest.js
```

## License

[MIT](LICENSE)
