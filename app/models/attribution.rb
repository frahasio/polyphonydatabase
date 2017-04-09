class Attribution < ActiveRecord::Base
  belongs_to :inclusion, inverse_of: :attributions
  belongs_to :alias, inverse_of: :attributions, optional: true
  belongs_to :composer, inverse_of: :attributions, optional: true
  belongs_to :anonym, inverse_of: :attributions, optional: true
  accepts_nested_attributes_for :anonym

  
end
