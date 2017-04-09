class Inclusion < ActiveRecord::Base
  belongs_to :source, inverse_of: :inclusions
  belongs_to :piece, inverse_of: :inclusions
  has_many :attributions, inverse_of: :inclusion
  accepts_nested_attributes_for :attributions, :piece
  # has_many :forced_composers, class_name: "Composer"
  # has_many :cited_composers, through: :attributions, source: :composer
  # has_many :inferred_composers, through: :attributions, source: :composers
  #
  # def composers
  #   forced_composers.union(cited_composers).union(inferred_composers)
  # end
end
