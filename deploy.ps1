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

# Get current branch
$currentBranch = git rev-parse --abbrev-ref HEAD
Write-Host "Current branch: $currentBranch" -ForegroundColor Yellow

# Stage and commit changes
Write-Host "Staging and committing changes..."
git add .
git commit -m $commitMessage

# Push to GitHub
Write-Host "Pushing to GitHub..."
git push origin $currentBranch

# Push to Heroku
Write-Host "Pushing to Heroku..."
git push heroku $currentBranch:main --force

# Check deployment status
Write-Host "Checking deployment status..."
heroku releases --app $herokuAppName | Select-Object -First 1

Write-Host "`nDeployment complete! You can check the full logs with: heroku logs --app $herokuAppName" -ForegroundColor Green 