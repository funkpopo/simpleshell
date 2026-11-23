; SimpleShell Windows Installer Script (Inno Setup 6)
; Parameterized via ISCC /D defines so `npm run make` drives it directly,
; while keeping sensible defaults for opening and compiling in Inno Setup IDE.

#ifndef AppName
  #define AppName "SimpleShell"
#endif

#ifndef AppVersion
  #define AppVersion "0.6.0"
#endif

#ifndef AppArch
  #define AppArch "x64"
#endif

#ifndef SourceDir
  #define SourceDir "..\\out\\" + AppName + "-win32-" + AppArch
#endif

#ifndef OutputDir
  #define OutputDir "."
#endif

#ifndef OutputBaseFilename
  #define OutputBaseFilename AppName + "-v" + AppVersion + "-Setup-" + AppArch
#endif

#ifndef AppIcon
  #define AppIcon "..\\src\\renderer\\assets\\logo.ico"
#endif

#ifndef LicenseFile
  #define LicenseFile "..\\LICENSE"
#endif

#ifndef AppCopyright
  #define AppCopyright "Copyright (C) 2026 funkpopo"
#endif

#ifndef AppPublisher
  #define AppPublisher "funkpopo"
#endif

#ifndef AppURL
  #define AppURL "https://github.com/funkpopo/simpleshell"
#endif

#ifndef AppExeName
  #define AppExeName AppName + ".exe"
#endif

#ifndef AppUserModelId
  #define AppUserModelId "com.funkpopo.simpleshell"
#endif

#ifndef AppNumericVersion
  #define private _CleanVer AppVersion
  #if Pos("-", _CleanVer) > 0
    #define private _CleanVer Copy(_CleanVer, 1, Pos("-", _CleanVer) - 1)
  #endif
  #if Pos("+", _CleanVer) > 0
    #define private _CleanVer Copy(_CleanVer, 1, Pos("+", _CleanVer) - 1)
  #endif
  #define AppNumericVersion _CleanVer + ".0"
#endif

[Setup]
; Stable AppId across releases so upgrades replace the existing installation cleanly.
AppId={{C7A4D8E2-5F1B-4A9E-8C3D-2E6F9A1B4D70}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
AppCopyright={#AppCopyright}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
AllowNoIcons=yes
DisableProgramGroupPage=yes
LicenseFile={#LicenseFile}
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
SetupIconFile={#AppIcon}
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=yes
#if LowerCase(AppArch) == "arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#elif LowerCase(AppArch) == "ia32" || LowerCase(AppArch) == "x86"
ArchitecturesAllowed=x86compatible
#else
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#endif
VersionInfoCompany={#AppPublisher}
VersionInfoCopyright={#AppCopyright}
VersionInfoDescription={#AppName} Installer
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}
VersionInfoVersion={#AppNumericVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
#if FileExists(CompilerPath + "Languages\ChineseSimplified.isl")
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
#endif

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; AppUserModelID: "{#AppUserModelId}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon; AppUserModelID: "{#AppUserModelId}"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
