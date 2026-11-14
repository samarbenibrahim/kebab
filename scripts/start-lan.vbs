' SOUCOFFE - accès depuis un téléphone sur le même Wi-Fi.
' Démarre MariaDB si besoin, puis (sans fenêtre visible) :
'   - l'API PHP à l'écoute du réseau local : http://<IP-du-PC>:8000/api
'   - le site statique via scripts/lan_router.php : http://<IP-du-PC>:8080/
' Le routeur ne sert que HTML/JS/CSS/images (jamais api/, database/, scripts/).
' Sur le téléphone, ouvrir http://<IP-du-PC>:8080/ (l'IP s'affiche à la fin).
Option Explicit
Dim sh, fso, root, mariadb, php, ex, out, ip, re, m
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
mariadb = "C:\Program Files\MariaDB 13.0\bin\mariadbd.exe"
php = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe"

Function ListeningLine(port)
    Set ex = sh.Exec("cmd /c netstat -ano | findstr "":" & port & " "" | findstr LISTENING")
    ListeningLine = Trim(ex.StdOut.ReadAll)
End Function

If Len(ListeningLine(3306)) = 0 And fso.FileExists(mariadb) Then
    sh.Run """" & mariadb & """ --console", 0, False
    WScript.Sleep 6000
End If

sh.CurrentDirectory = root
' API : si elle n'écoute que sur localhost ([::1] / 127.0.0.1), elle n'est pas
' joignable depuis le téléphone -> on la relance sur toutes les interfaces.
out = ListeningLine(8000)
If Len(out) > 0 And InStr(out, "0.0.0.0:8000") = 0 Then
    sh.Run "cmd /c for /f ""tokens=5"" %p in ('netstat -ano ^| findstr "":8000 "" ^| findstr LISTENING') do taskkill /PID %p /F", 0, True
    out = ""
End If
If Len(out) = 0 Then sh.Run """" & php & """ -S 0.0.0.0:8000 api/index.php", 0, False
If Len(ListeningLine(8080)) = 0 Then sh.Run """" & php & """ -S 0.0.0.0:8080 scripts/lan_router.php", 0, False

' Adresse IPv4 locale du PC, pour l'afficher.
Set ex = sh.Exec("cmd /c ipconfig")
out = ex.StdOut.ReadAll
Set re = New RegExp
re.Pattern = "IPv4[^:]*:\s*(\d+\.\d+\.\d+\.\d+)"
re.Global = False
ip = "IP-du-PC"
If re.Test(out) Then
    Set m = re.Execute(out)
    ip = m(0).SubMatches(0)
End If
MsgBox "SOUCOFFE est accessible sur le Wi-Fi :" & vbCrLf & vbCrLf & _
    "Client : http://" & ip & ":8080/" & vbCrLf & _
    "Admin  : http://" & ip & ":8080/09-Connexion/login.html", 64, "SOUCOFFE - téléphone"
