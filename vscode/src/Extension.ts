import * as vscode from 'vscode';

import { DaemonClient } from './DaemonClient';
import { DocumentLeaseController } from './DocumentLeaseController';
import { VsCodeLeaseUx } from './Ux';

let controller: DocumentLeaseController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const configuration = vscode.workspace.getConfiguration('localFileLock');
  const client = new DaemonClient({
    socketPath: configuration.get<string>('socketPath') || undefined,
  });
  const ux = new VsCodeLeaseUx();
  controller = new DocumentLeaseController({
    client,
    ux,
    ttlMs: configuration.get<number>('ttlMs') ?? 30_000,
  });

  for (const document of vscode.workspace.textDocuments) {
    controller.trackDocument(toLockableDocument(document));
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      controller?.trackDocument(toLockableDocument(document));
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      controller?.onDocumentChange(toLockableDocument(event.document));
    }),
    vscode.workspace.onWillSaveTextDocument((event) => {
      controller?.onWillSaveDocument(toLockableDocument(event.document));
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      void controller?.onDocumentSave(toLockableDocument(document));
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      void controller?.onDocumentClose(toLockableDocument(document));
    }),
    {
      dispose: () => {
        void controller?.dispose();
      },
    }
  );
}

export async function deactivate(): Promise<void> {
  await controller?.dispose();
  controller = undefined;
}

function toLockableDocument(document: vscode.TextDocument) {
  return {
    uri: document.uri.toString(),
    scheme: document.uri.scheme,
    fsPath: document.uri.fsPath,
    isDirty: document.isDirty,
  };
}
