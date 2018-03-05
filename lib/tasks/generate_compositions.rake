desc "Creates compositions based on inclusions etc."
task generate_compositions: :environment do
  CompositionGenerator.run
end
