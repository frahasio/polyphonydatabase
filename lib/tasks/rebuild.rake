namespace :rebuild do
  desc "Rebuild the local database from production"
  task local: :environment do
    abort("You're not running in development!") unless Rails.env.development?

    system("bundle exec rake db:drop RAILS_ENV=development")
    system("heroku pg:pull -a music-cms-demo DATABASE_URL polyphonydatabase_development")
    system("bundle exec rake db:environment:set RAILS_ENV=development")
  end
end
