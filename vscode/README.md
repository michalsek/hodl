# hodl-vscode-plugin

VS Code extension for the `hodl` daemon.

## Build

```sh
cd vscode
yarn install
yarn build
```

## Package

```sh
cd vscode
yarn package
```

The generated `.vsix` is written into `vscode/.artifacts/`.

## Install The VSIX

```sh
code --install-extension /absolute/path/to/vscode/.artifacts/hodl-vscode-plugin.vsix
```

## Test Locally

1. Start the daemon with `hodl`
2. Install the packaged VSIX
3. Open a file-backed workspace in VS Code
4. Edit a file and verify the daemon acquires and renews a lease
