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

  def attributed_to
    attributions.map(&:name).join(" | ")
  end

  def attributed_to=(text)
    names = text
      .split("|")
      .map(&:strip)
      .reject(&:blank?)

    Attribution.set_by_names(self, names)
  end
end
