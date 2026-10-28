// File System Access API(Chrome/Edge限定)の型は、TypeScript標準のlib.dom.d.tsに
// まだ含まれていないため、このアプリで使う最小限の部分だけここで補う。

interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface OpenFilePickerOptions {
  types?: { description?: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
}

interface Window {
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
}
