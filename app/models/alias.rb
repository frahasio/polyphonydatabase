class Alias < ActiveRecord::Base
  belongs_to :composer, inverse_of: :aliases
  belongs_to :anonym, inverse_of: :aliases
  has_many :attributions, inverse_of: :alias

  validates :composer_id, uniqueness: { scope: :anonym_id }

  def anonym_name
    anonym&.name
  end

  def self.set_by_names(composer, names)
    names.each do |name|
      if composer.aliases.none? { |a| a.anonym_name == name }
        new_alias = composer.aliases.build
        new_alias.anonym = Anonym.find_or_initialize_by(name: name)
      end
    end

    composer.aliases.each do |composer_alias|
      composer_alias.destroy unless names.include?(composer_alias.anonym_name)
    end
  end
end
