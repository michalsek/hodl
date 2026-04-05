import path from 'node:path';

import * as vscode from 'vscode';

export interface LeaseUx {
  markBlocked(documentUri: string, message: string): void;
  clearBlocked(documentUri: string): void;
  showAcquireFailure(documentUri: string, message: string): void;
  showLeaseLost(documentUri: string, message: string): void;
  showSaveWarning(documentUri: string, message: string): void;
  dispose(): void;
}

export class VsCodeLeaseUx implements LeaseUx {
  private readonly statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  private readonly blockedDocuments = new Map<string, string>();

  constructor() {
    this.statusBarItem.name = 'Local File Locks';
    this.statusBarItem.hide();
  }

  markBlocked(documentUri: string, message: string): void {
    this.blockedDocuments.set(documentUri, message);
    this.render();
  }

  clearBlocked(documentUri: string): void {
    this.blockedDocuments.delete(documentUri);
    this.render();
  }

  showAcquireFailure(documentUri: string, message: string): void {
    void vscode.window.showErrorMessage(`${this.formatDocument(documentUri)}: ${message}`);
  }

  showLeaseLost(documentUri: string, message: string): void {
    void vscode.window.showErrorMessage(`${this.formatDocument(documentUri)}: ${message}`);
  }

  showSaveWarning(documentUri: string, message: string): void {
    void vscode.window.showWarningMessage(`${this.formatDocument(documentUri)}: ${message}`);
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }

  private render(): void {
    if (this.blockedDocuments.size === 0) {
      this.statusBarItem.hide();
      return;
    }

    const latestMessage = Array.from(this.blockedDocuments.values()).at(-1) ?? 'Lock unavailable';
    this.statusBarItem.text = `$(warning) File locks: ${this.blockedDocuments.size} blocked`;
    this.statusBarItem.tooltip = latestMessage;
    this.statusBarItem.show();
  }

  private formatDocument(documentUri: string): string {
    return path.basename(documentUri);
  }
}
