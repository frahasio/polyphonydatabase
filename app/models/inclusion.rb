class Inclusion < ActiveRecord::Base
  belongs_to :source, inverse_of: :inclusions
  belongs_to :piece, inverse_of: :inclusions, optional: true
  belongs_to :composition, inverse_of: :inclusions, optional: true
  belongs_to :clef_combination, optional: true
  has_many :composers, through: :attributions, source: :refers_to
  has_many :attributions, inverse_of: :inclusion, dependent: :destroy
  has_many :clefs, through: :clefs_inclusions
  accepts_nested_attributes_for :attributions, reject_if: :all_blank
  accepts_nested_attributes_for :piece, reject_if: :all_blank
  accepts_nested_attributes_for :composition

  #TODO Dead code
  has_many :clefs_inclusions, inverse_of: :inclusion
  belongs_to :unique_piece, inverse_of: :inclusions, optional: true
  accepts_nested_attributes_for :clefs_inclusions, reject_if: :filler_clef?

  #TODO Dead code
  def attributed_to
    attributions.map(&:anonym_name).join(" | ")
  end

  #TODO Dead code
  def attributed_to=(text)
    names = text
      .split("|")
      .map(&:strip)
      .reject(&:blank?)

    Attribution.set_by_names(self, names)
  end

  #TODO Dead code
  def filler_clef?(attrs)
    attrs[:annotated_note].blank? && attrs[:id].blank?
  end

  def from_year
    source.from_year
  end

  def minimum_voice_count
    required_clefs.size
  end

  #TODO Dead code
  def voice_count
    clefs_inclusions.count
  end

  def display_clefs=(annotated_notes)
    inclusion_combination = ClefCombination.from_display(annotated_notes)
    self.clef_combination = inclusion_combination[:combination]
    self.missing_clef_ids = inclusion_combination[:missing_ids]
    self.incomplete_clef_ids = inclusion_combination[:incomplete_ids]
    self.transitions_to = inclusion_combination[:transitions_to]
  end

  def display_clefs
    return [] if clef_combination.nil?
    clef_combination.to_display(missing_clef_ids, incomplete_clef_ids, transitions_to)
  end

  def public_notes
    if composition.group.conflicting_attributions?
      attrib_texts = attributions.map {|a| a.text.blank? ? "Anon" : a.text}
      ["Attrib: #{attrib_texts.join(', ')}", notes].reject(&:blank?).join("; ")
    else
      notes
    end
  end

  private

  def required_clefs
    return [] if clef_combination.nil?
    clef_combination.clefs.reject(&:optional?).reject(&:special?)
  end
end
