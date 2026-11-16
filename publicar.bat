@echo off
rem Publica Foco Cero: guarda los cambios en git, los sube a GitHub (Vercel despliega solo) y actualiza Supabase.
cd /d "%~dp0"
git add -A
git commit -m "Foco Cero: serie Armonizada por concordancia, Combinacion, prioridad por sensor e idioma ingles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01BW8eRDcmhT5dpmH6TEYwtq"
git push origin main
git push vercel main
cd etl
python upload_supabase.py --replace --yes
echo.
echo Listo. Vercel tarda 1 o 2 minutos en publicar la version nueva.
pause
