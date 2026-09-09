@echo off
title CodeLens - Iniciando...
color 0A
echo.
echo  ===================================
echo   CodeLens - Iniciando o servidor
echo  ===================================
echo.

:: Verificar se Node.js está instalado
node --version >nul 2>&1
if errorlevel 1 (
    color 0C
    echo  ERRO: Node.js nao encontrado!
    echo.
    echo  Instale o Node.js em: https://nodejs.org
    echo  Baixe a versao LTS (botao verde)
    echo.
    pause
    exit /b 1
)

echo  Node.js encontrado! Versao:
node --version
echo.

:: Instalar dependencias se necessario
if not exist "node_modules" (
    echo  Instalando dependencias pela primeira vez...
    echo  Isso pode demorar alguns minutos...
    echo.
    npm install
    if errorlevel 1 (
        color 0C
        echo.
        echo  ERRO ao instalar dependencias!
        echo  Verifique sua conexao com a internet.
        pause
        exit /b 1
    )
    echo.
    echo  Dependencias instaladas com sucesso!
    echo.
)

:: Iniciar o servidor backend em segundo plano
echo  Iniciando servidor backend...
start "CodeLens Backend" cmd /k "node server.cjs"

:: Aguardar um momento
timeout /t 2 /nobreak >nul

:: Iniciar o frontend
echo  Iniciando o app...
echo.
echo  Quando abrir, acesse: http://localhost:5000
echo.
npm run dev

pause
