# Deploy script for GitHub and Heroku
param(
    [string]$commitMessage = "Update changes",
    [string]$herokuAppName = "polyphony-database-node"
)

# Check if Heroku CLI is installed
try {
    $herokuVersion = heroku --version
    Write-Host "Heroku CLI version: $herokuVersion" -ForegroundColor Green
} catch {
    Write-Host "Error: Heroku CLI is not installed. Please install it from https://devcenter.heroku.com/articles/heroku-cli" -ForegroundColor Red
    exit 1
}

# Check if logged in to Heroku
try {
    $herokuWhoami = heroku whoami
    Write-Host "Logged in to Heroku as: $herokuWhoami" -ForegroundColor Green
} catch {
    Write-Host "Error: Not logged in to Heroku. Please run 'heroku login' first." -ForegroundColor Red
    exit 1
}

# Check if Heroku remote exists, if not add it
$herokuRemote = git remote | Select-String "heroku"
if (-not $herokuRemote) {
    if (-not $herokuAppName) {
        Write-Host "Error: Heroku app name is required. Please provide it as a parameter: ./deploy.ps1 -herokuAppName 'your-app-name'" -ForegroundColor Red
        exit 1
    }
    Write-Host "Adding Heroku remote..." -ForegroundColor Yellow
    git remote add heroku "https://git.heroku.com/$herokuAppName.git"
}

# Push to GitHub
Write-Host "`nPushing to GitHub..." -ForegroundColor Green
git add .
git commit -m $commitMessage
git push origin node-rewrite

# Push to Heroku
Write-Host "`nPushing to Heroku..." -ForegroundColor Green
git push heroku node-rewrite:main --force

# Show deployment status
Write-Host "`nChecking deployment status..." -ForegroundColor Green
if ($herokuAppName) {
    heroku logs --tail --app $herokuAppName
} else {
    heroku logs --tail
} 