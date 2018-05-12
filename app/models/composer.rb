class Composer < ActiveRecord::Base
  has_and_belongs_to_many :compositions
  has_many :groups, through: :compositions

  validates :name, uniqueness: true, presence: true

  validate :years_are_valid

  def dates
    [
      "#{from_year_annotation}#{from_year}",
      "#{to_year_annotation}#{to_year}",
    ].reject(&:blank?).join("-")
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
