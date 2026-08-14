import { router } from "expo-router";
import { LibraryScreen } from "../src/library/LibraryScreen";

const documents = [] as const;

function openNewDocument() {
  router.push({ pathname: "/editor/[id]", params: { id: "new" } });
}

function openDocument(id: string) {
  router.push({ pathname: "/editor/[id]", params: { id } });
}

function deferImport() {}

function deferDocumentActions() {}

export default function LibraryRoute() {
  return (
    <LibraryScreen
      documents={documents}
      onDocumentActions={deferDocumentActions}
      onImportDocument={deferImport}
      onNewDocument={openNewDocument}
      onOpenDocument={openDocument}
    />
  );
}
