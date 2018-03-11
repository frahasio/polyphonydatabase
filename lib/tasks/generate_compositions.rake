namespace :generate do
  desc "Creates compositions based on inclusions etc."
  task compositions: :environment do
    CompositionGenerator.run
  end
end
