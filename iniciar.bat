@echo off
setlocal
cd /d "%~dp0"
title LLM Lucca

where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js 20 ou superior.
  goto :erro
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo Este projeto precisa do Node.js 20 ou superior.
  goto :erro
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo npm nao encontrado. Reinstale o Node.js com o npm.
  goto :erro
)

where docker.exe >nul 2>&1
if errorlevel 1 (
  echo Docker nao encontrado. Instale e abra o Docker Desktop.
  goto :erro
)

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker Desktop nao esta em execucao. Abra-o e tente novamente.
  goto :erro
)

if not exist "node_modules" (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 goto :erro
)

echo Preparando banco e configuracao...
call npm run setup
if errorlevel 1 goto :erro

echo.
echo Iniciando o LLM Lucca. Abra http://localhost:5173 no navegador.
echo Para encerrar, pressione Ctrl+C nesta janela.
echo.
call npm run dev
if errorlevel 1 goto :erro
exit /b 0

:erro
echo.
echo Nao foi possivel iniciar o projeto. Confira a mensagem acima.
pause
exit /b 1
