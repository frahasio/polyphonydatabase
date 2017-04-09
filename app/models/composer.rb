class Composer < ActiveRecord::Base
  has_many :aliases, inverse_of: :composer
  has_many :attributions, inverse_of: :composer
end
