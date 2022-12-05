class Inclusion < ActiveRecord::Base
  belongs_to :source, inverse_of: :inclusions
  belongs_to :composition, inverse_of: :inclusions, optional: true
  belongs_to :clef_combination, optional: true
  has_many :attributions, inverse_of: :inclusion, dependent: :destroy
  has_many :composers, through: :attributions, source: :refers_to
  accepts_nested_attributes_for :attributions, reject_if: :all_blank
  accepts_nested_attributes_for :composition

  def from_year
    source.from_year
  end

  def minimum_voice_count
    required_clefs.size
  end

  def display_clefs=(annotated_notes)
    inclusion_combination = ClefCombination.from_display(annotated_notes)

    if inclusion_combination.nil?
      self.clef_combination = nil
      self.missing_clef_ids = []
      self.incomplete_clef_ids = []
      self.both_clef_ids = []
      self.transitions_to = {}
    else
      self.clef_combination = inclusion_combination[:combination]
      self.missing_clef_ids = inclusion_combination[:missing_ids]
      self.incomplete_clef_ids = inclusion_combination[:incomplete_ids]
      self.both_clef_ids = inclusion_combination[:both_ids]
      self.transitions_to = inclusion_combination[:transitions_to]
    end
  end

  def display_clefs
    return [] if clef_combination.nil?
    clef_combination.to_display(missing_clef_ids, incomplete_clef_ids, both_clef_ids, transitions_to)
  end

  def public_notes
      attrib_texts = attributions.map {|a| a.text.blank? ? "Anon" : a.text}
      ["Attrib: #{attrib_texts.join(', ')}", notes].reject(&:blank?).join("; ")
  end

  private

  def required_clefs
    return [] if clef_combination.nil?
    clef_combination.clefs.reject(&:optional?).reject(&:special?)
  end
end
