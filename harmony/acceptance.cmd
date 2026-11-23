@echo off
rem Run the acceptance script with the execution policy bypassed.
rem Local .ps1 files are blocked by RemoteSigned, hence -ExecutionPolicy Bypass.
powershell -ExecutionPolicy Bypass -File "%~dp0acceptance.ps1" %*
