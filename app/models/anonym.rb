class Anonym < ActiveRecord::Base
  has_many :aliases, inverse_of: :anonym
  has_many :attributions, inverse_of: :anonym

  validates :name, uniqueness: true
end
