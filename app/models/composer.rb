class Composer < ActiveRecord::Base
  has_many :aliases, inverse_of: :composer
  has_many :attributions, inverse_of: :composer

  validates :name, uniqueness: true

  validate :years_are_valid

  def years_are_valid
    [
      :from_year,
      :to_year,
    ].each do |field|
      unless field.to_s =~ /^\d{4}$/
        errors.add(field, :invalid, "must be a 4-digit year")
      end
    end
  end
end
