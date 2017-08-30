require "denormaliser"

desc "Denormalises the searchable parts of the database to speed up the homepage"
task denormalise: :environment do
  Denormaliser.run
end
