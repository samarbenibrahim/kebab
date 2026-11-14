' SOUCOFFE - demarrage automatique du restaurant sur ce PC (sans fenetre).
' Lance au demarrage de la session Windows (raccourci dans le dossier Demarrage,
' cree par scripts\installer-demarrage-auto.ps1). Peut aussi etre lance a la main.
'   - MariaDB (base de donnees)            port 3306
'   - API PHP sur le reseau local          http://<IP-du-PC>:8000/api
'   - site via scripts/lan_router.php      http://<IP-du-PC>:8080/
' Ensuite, toutes les 30 secondes, relance ce qui se serait arrete.
' Une seule copie tourne a la fois (les copies suivantes s'arretent seules).
Option Explicit
Dim sh, fso, root, mariadb, php, wmi, procs, p, n

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
mariadb = "C:\Program Files\MariaDB 13.0\bin\mariadbd.exe"
php = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe"

' Une seule copie de ce script.
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set procs = wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name = 'wscript.exe' OR Name = 'cscript.exe'")
n = 0
For Each p In procs
    If Not IsNull(p.CommandLine) Then
        If InStr(LCase(p.CommandLine), "demarrage-auto.vbs") > 0 Then n = n + 1
    End If
Next
If n > 1 Then WScript.Quit

Function IsListening(port)
    Dim tempPath, cmd, rc, ts, content, re

    tempPath = sh.ExpandEnvironmentStrings("%TEMP%") & "\soucoffe-netstat-" & port & ".txt"

    cmd = """" & sh.ExpandEnvironmentStrings("%ComSpec%") & """ /d /c netstat -ano -p tcp > """ & tempPath & """"
    rc = sh.Run(cmd, 0, True)

    content = ""
    If fso.FileExists(tempPath) Then
        Set ts = fso.OpenTextFile(tempPath, 1)
        content = ts.ReadAll
        ts.Close
        fso.DeleteFile tempPath, True
    End If

    Set re = New RegExp
    re.IgnoreCase = True
    re.Global = False
    re.Pattern = ":\s*" & CStr(port) & "\s+.*LISTENING"

    IsListening = re.Test(content)
End Function

' Journal (logs\demarrage.log) : chaque (re)lancement y est note, pour savoir
' quand et pourquoi le site s'est arrete. Le fichier est vide chaque mois.
Sub WriteLog(msg)
    On Error Resume Next
    Dim dir, path, ts
    dir = root & "\logs"
    If Not fso.FolderExists(dir) Then fso.CreateFolder dir
    path = dir & "\demarrage.log"
    If fso.FileExists(path) Then
        If Month(fso.GetFile(path).DateLastModified) <> Month(Now) Then fso.DeleteFile path, True
    End If
    Set ts = fso.OpenTextFile(path, 8, True)
    ts.WriteLine Year(Now) & "-" & Right("0" & Month(Now), 2) & "-" & Right("0" & Day(Now), 2) & " " & FormatDateTime(Now, 4) & "  " & msg
    ts.Close
End Sub

sh.CurrentDirectory = root
WriteLog "Surveillant demarre"
Do
    If Not IsListening(3306) And fso.FileExists(mariadb) Then
        WriteLog "Base de donnees arretee : relance"
        sh.Run """" & mariadb & """ --console", 0, False
        WScript.Sleep 6000
    End If
    If Not IsListening(8000) And fso.FileExists(php) Then
        WriteLog "API (port 8000) arretee : relance"
        sh.Run """" & php & """ -S 0.0.0.0:8000 api/index.php", 0, False
    End If
    If Not IsListening(8080) And fso.FileExists(php) Then
        WriteLog "Site (port 8080) arrete : relance"
        sh.Run """" & php & """ -S 0.0.0.0:8080 scripts/lan_router.php", 0, False
    End If
    WScript.Sleep 30000
Loop
