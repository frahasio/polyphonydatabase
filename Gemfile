source "https://rubygems.org"

ruby "3.2.2"

# Bundle edge Rails instead: gem "rails", github: "rails/rails"
gem "rails", "< 7"
# Use postgresql as the database for Active Record
gem "pg", "~> 1.5"
# Use Puma as the app server
gem "puma", "~> 6.2"
# Use SCSS for stylesheets
gem "sass-rails", "~> 6.0"
# Use Uglifier as compressor for JavaScript assets
gem "uglifier", "~> 4.2"

gem "net-smtp", require: false
gem "net-imap", require: false
gem "net-pop", require: false

# Use jquery as the JavaScript library
gem "jquery-rails", "~> 4.5"

gem "active_record_union", "~> 1.3"
gem "generic_form_builder", "~> 0.13"

gem "kaminari", "~> 1.2"

group :development, :test do
  # Call "byebug" anywhere in the code to stop execution and get a debugger console
  gem "byebug", "~> 11.1", platform: :mri
end

group :development do
  # Access an IRB console on exception pages or by using <%= console %> anywhere in the code.
  gem "web-console", "~> 4.2", ">= 3.3.0"
  gem "listen", "~> 3.8"
  # Spring speeds up development by keeping your application running in the background. Read more: https://github.com/rails/spring
  gem "spring", "~> 4.1"
  gem "spring-watcher-listen", "~> 2.1"
  gem "ruby-prof", "~> 1.6"

  gem "bullet", "~> 7.0"
end

group :test do
  gem "factory_bot_rails", "~> 6.2"
  gem "rspec-rails", "~> 6.0"
  gem "capybara", "~> 3.39"
  gem "launchy"
end
