#ifndef MyAppVersion
  #error MyAppVersion must be provided with /DMyAppVersion=<version>
#endif

#define MyAppName "epub.ts"
#define MyAppExeName "epub.ts.exe"
#define RepoRoot SourcePath + "\..\.."

[Setup]
AppId=io.github.jay-waves.epub.ts
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=jay-waves
AppPublisherURL=https://github.com/jay-waves/epub.ts
AppSupportURL=https://github.com/jay-waves/epub.ts/issues
AppUpdatesURL=https://github.com/jay-waves/epub.ts/releases
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesAssociations=yes
CloseApplications=yes
Compression=lzma2/max
SolidCompression=yes
SetupIconFile={#RepoRoot}\assets\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
OutputDir={#RepoRoot}\release
OutputBaseFilename=epub-ts-setup-v{#MyAppVersion}
VersionInfoVersion={#MyAppVersion}
WizardStyle=modern

[Files]
Source: "{#RepoRoot}\release\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
Root: HKCU; Subkey: "Software\Classes\epub.ts.Document"; ValueType: string; ValueData: "epub.ts Document"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\epub.ts.Document\Application"; ValueType: string; ValueName: "ApplicationName"; ValueData: "epub.ts"
Root: HKCU; Subkey: "Software\Classes\epub.ts.Document\Application"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Open EPUB documents with epub.ts"
Root: HKCU; Subkey: "Software\Classes\epub.ts.Document\DefaultIcon"; ValueType: string; ValueData: "{app}\{#MyAppExeName},0"
Root: HKCU; Subkey: "Software\Classes\epub.ts.Document\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"" open ""%1"""
Root: HKCU; Subkey: "Software\Classes\.epub\OpenWithProgids"; ValueType: none; ValueName: "epub.ts.Document"; Flags: uninsdeletevalue

[UninstallRun]
Filename: "{app}\{#MyAppExeName}"; Parameters: "stop"; Flags: runhidden skipifdoesntexist; RunOnceId: "StopDaemon"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  if FileExists(ExpandConstant('{app}\{#MyAppExeName}')) then
    Exec(ExpandConstant('{app}\{#MyAppExeName}'), 'stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
