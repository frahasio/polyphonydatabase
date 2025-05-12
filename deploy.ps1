# Deploy script for GitHub and Heroku
param(
    [string]$commitMessage = "Update changes"
)

# Push to GitHub
Write-Host "Pushing to GitHub..." -ForegroundColor Green
git add .
git commit -m $commitMessage
git push origin node-rewrite

# Push to Heroku
Write-Host "`nPushing to Heroku..." -ForegroundColor Green
git push heroku node-rewrite:main --force

# Show deployment status
Write-Host "`nChecking deployment status..." -ForegroundColor Green
heroku logs --tail 