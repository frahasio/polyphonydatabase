class Composer < ActiveRecord::Base
  has_many :aliases, inverse_of: :composer
  has_many :attributions, inverse_of: :composer

  validates :name, uniqueness: true

  validate :years_are_valid

  def all_attributions
    aliases.flat_map(&:attributions) | attributions
  end

  def inclusions
    all_attributions.map(&:inclusion).uniq
  end

  def pieces
    inclusions.map(&:piece).uniq
  end

  def aliased_as
    aliases.map(&:anonym_name).join(" | ")
  end

  def aliased_as=(text)
    names = text
      .split("|")
      .map(&:strip)
      .reject(&:blank?)

    Alias.set_by_names(self, names)
  end

  def dates
    "#{from_year_annotation}#{from_year}-#{to_year_annotation}#{to_year}"
  end

private

  def years_are_valid
    [
      :from_year,
      :to_year,
    ].each do |field|
      date = self[field]
      unless date.blank? || date.to_s =~ /^\d{4}$/
        errors.add(field, :invalid, message: "must be a 4-digit year")
      end
    end
  end
end
