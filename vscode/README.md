# local-filelockd-vscode

VS Code extension for the `local-filelockd` daemon.

## Build

```sh
cd /Users/michalsek/Documents/home/senekapp
yarn workspace local-filelockd-vscode build
```

## Package

```sh
cd /Users/michalsek/Documents/home/senekapp
yarn workspace local-filelockd-vscode package
```

The generated `.vsix` is written into `apps/daemon/vscode/.artifacts/`.

## Install The VSIX

```sh
code --install-extension /Users/michalsek/Documents/home/senekapp/apps/daemon/vscode/.artifacts/local-filelockd-vscode.vsix
```

## Test Locally

1. Start the daemon with `yarn workspace local-filelockd start`
2. Install the packaged VSIX
3. Open a file-backed workspace in VS Code
4. Edit a file and verify the daemon acquires and renews a lease
