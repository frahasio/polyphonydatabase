class Composer < ActiveRecord::Base
  # has_many :pieces
  # has_many :aliases
  has_many :attributions, inverse_of: :composer
end
