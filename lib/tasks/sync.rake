namespace :sync do
  desc "Sync the local database from production"
  task production_to_local: :environment do
    abort("You're not running in development!") unless Rails.env.development?

    system("bundle exec rake db:drop RAILS_ENV=development")
    system("heroku pg:pull -a music-cms-demo DATABASE_URL polyphonydatabase_development")
    system("bundle exec rake db:environment:set RAILS_ENV=development")
    system("bundle exec rake db:create:all RAILS_ENV=development")
  end

  desc "Sync production to staging"
  task production_to_staging: :environment do
    system("heroku pg:backups:capture -a music-cms-demo")
    system("heroku pg:backups:restore -a polyphonydatabase-staging `heroku pg:backups:url -a music-cms-demo`")
  end
end
