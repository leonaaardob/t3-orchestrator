/** electron-builder diagnostic dumps — never release assets. */
export function isBuilderDebugArtifactName(fileName: string): boolean {
  return fileName === "builder-debug.yml" || fileName.startsWith("builder-debug-");
}
