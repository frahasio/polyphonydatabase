class Inclusion < ApplicationRecord
  belongs_to :source, inverse_of: :inclusions
  belongs_to :composition, inverse_of: :inclusions, optional: true
  belongs_to :clef_combination, optional: true
  has_many :attributions, inverse_of: :inclusion, dependent: :destroy
  has_many :composers, through: :attributions, source: :refers_to
  has_many :clef_inclusions, dependent: :destroy, inverse_of: :inclusion

  accepts_nested_attributes_for :attributions, reject_if: :all_blank
  accepts_nested_attributes_for :clef_inclusions, reject_if: :all_blank

  before_validation :set_clef_combination

  delegate :from_year, to: :source

  def public_notes
    notes
  end

  def public_attrib
    attrib_texts = attributions.map {|a| a.text.blank? ? "Anon" : a.text}
    "Attrib: #{attrib_texts.uniq.join(', ')}"
  end

  private

  def set_clef_combination
    display_combination = clef_inclusions.to_a
      .sort_by(&:sort_value)
      .map { |ci| ci.display(source_context: false) }
      .join

    self.clef_combination = ClefCombination.find_or_initialize_by(display: display_combination)
  end
end
