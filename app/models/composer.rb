class Composer < ApplicationRecord
  has_and_belongs_to_many :compositions
  has_many :groups, through: :compositions

  has_many :attributions, inverse_of: :refers_to

  validates :name, uniqueness: true, presence: true

  validate :years_are_valid

  ANON_NAME = "Anon".freeze

  def self.anon
    find_or_initialize_by(name: ANON_NAME)
  end

  def dates
    [
      "#{from_year_annotation}#{from_year}",
      "#{to_year_annotation}#{to_year}",
    ].reject(&:blank?).join("–")
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
