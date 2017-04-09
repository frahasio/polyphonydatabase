class Anonym < ActiveRecord::Base
  has_many :aliases, inverse_of: :anonym
  # has_many :composers, through: :aliases, source: :composer
  has_many :attributions, inverse_of: :anonym
end
