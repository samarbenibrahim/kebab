' SOUCOFFE - démarre MariaDB puis l'API PHP (localhost:8000) si elles ne tournent
' pas déjà, sans fenêtre visible. Lancé automatiquement à l'ouverture de session
' par la tâche planifiée "SOUCOFFE Backend" ; peut aussi être lancé à la main.
Option Explicit
Dim sh, fso, root, mariadb, php
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
mariadb = "C:\Program Files\MariaDB 13.0\bin\mariadbd.exe"
php = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe"

Function IsListening(port)
    Dim ex
    Set ex = sh.Exec("cmd /c netstat -ano | findstr "":" & port & " "" | findstr LISTENING")
    IsListening = (Len(Trim(ex.StdOut.ReadAll)) > 0)
End Function

If Not IsListening(3306) And fso.FileExists(mariadb) Then
    sh.Run """" & mariadb & """ --console", 0, False
    WScript.Sleep 6000
End If

If Not IsListening(8000) And fso.FileExists(php) Then
    sh.CurrentDirectory = root
    sh.Run """" & php & """ -S localhost:8000 api/index.php", 0, False
End If
