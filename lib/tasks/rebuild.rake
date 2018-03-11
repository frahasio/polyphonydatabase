namespace :rebuild do
  desc "Rebuild the local database from production"
  task local: :environment do
    abort("You're not running in development!") unless Rails.env.development?

    system("b/rake db:drop RAILS_ENV=development")
    system("heroku pg:pull -a music-cms-demo DATABASE_URL music-cms_development")
    system("b/rake db:environment:set db:migrate generate:compositions RAILS_ENV=development")
  end
end
