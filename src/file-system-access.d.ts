type FileSystemPermissionMode = "read" | "readwrite";
type WellKnownDirectory = "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";

type FileSystemHandlePermissionDescriptor = {
  mode?: FileSystemPermissionMode;
};

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface Window {
  showSaveFilePicker(options?: {
    id?: string;
    suggestedName?: string;
    startIn?: FileSystemHandle | WellKnownDirectory;
    types?: Array<{
      accept: Record<string, string[]>;
      description?: string;
    }>;
  }): Promise<FileSystemFileHandle>;
}
