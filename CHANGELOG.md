# Changelog


## Unreleased

- Programs split over several files now build: the `.cpp` file that goes with each `#include "x.h"` is compiled
  and linked too (`cppRunButton.followIncludes`, on by default).
- `cppRunButton.extraSources` setting for source files that aren't found that way.

## 0.3.0

- `cppRunButton.clearTerminal` setting: set it to `false` to keep the output of earlier runs in the terminal
  instead of clearing it on each click. Clearing stays the default.
- README: separate setup steps for native Windows and for WSL.

## 0.2.1
npm
- New icon: "C++" in terminal green, where the second + is cut through a ▶ button.

## 0.2.0

- Works alongside Microsoft's C/C++ extension:
  - Uses the compiler it is set up with (`c_cpp_properties.json`, then `C_Cpp.default.compilerPath`) when `g++`
    isn't on `PATH`.
  - Offers once to hide its Run button, so there aren't two in the title bar.
- `cppRunButton.compiler` is now empty by default, meaning "find one"; setting it still forces that compiler.

## 0.1.0

- First release: a ▶ button that saves, compiles and runs the open C++ file in the terminal panel.
- `cppRunButton.compiler` and `cppRunButton.compilerArgs` settings.
- Works with no folder open, running the program from the source file's folder.
- Clicking again stops a program that is still running before rebuilding.
