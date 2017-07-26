class FixAnonyms < ActiveRecord::Migration[5.0]
  def up
    Anonym.all.group_by(&:name).each do |name, anonyms|
      anonym_prime = anonyms.shift
      attributions = []
      aliases = []

      anonyms.each do |anonym|
        attributions += anonym.attributions
        aliases += anonym.aliases

        anonym.destroy!
      end

      attributions.each do |a|
        a.anonym = anonym_prime
        a.save!
      end

      aliases.each do |a|
        a.anonym = anonym_prime
        a.save
      end
    end
  end
end
