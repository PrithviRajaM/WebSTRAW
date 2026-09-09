@echo off
REM Launcher for the WebSTRAW native-messaging bridge host on Windows.
REM The browser passes the extension origin as an argument; it is forwarded to python.
REM Adjust the path to python.exe and to this script if they are not on PATH.
python "%~dp0webstraw_bridge_host.py" %*
