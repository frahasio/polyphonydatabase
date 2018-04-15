#TODO Dead code
class ClefsInclusion < ActiveRecord::Base
  belongs_to :inclusion, inverse_of: :clefs_inclusions
  belongs_to :clef, inverse_of: :clefs_inclusions

  def self.sort(objects)
    sortable, blank = objects.partition(&:persisted?)
    has_clef, missing_clef = sortable.partition(&:clef)

    hash_object = has_clef.each_with_object(Hash.new {|h, k| h[k] = []}) do |obj, hash|
      hash[obj.clef.note] << obj
      hash[obj.clef.note].sort_by! {|ci| ci.partial? ? 1 : 0 }
    end

    sorted = CLEF_ORDER.map { |note| hash_object[note] }.flatten.compact

    unsortable = has_clef - sorted

    return sorted + unsortable + missing_clef + blank
  end

  def transitional?
    transitions_to.present?
  end

  def annotated_note
    return "" if clef.nil?

    # Count transitional clef as one clef in min count
    annotated = [clef.note, transitions_to].reject(&:blank?).join("/")
    annotated = "(#{annotated})" if partial? # Do not include in min count
    annotated = "[#{annotated}]" if missing? # Include in min count

    return annotated
  end

  def annotated_note=(annotated)
    if annotated.blank?
      self.mark_for_destruction
    elsif annotated =~ %r{^(\[)?(\()?(\w+)(?:/(\w+))?}
      self.missing = $1.present?
      self.partial = $2.present?
      self.transitions_to = $4 unless $4.blank?
      self.clef = Clef.find_or_initialize_by(note: $3)
    end
  end

  def note_for_image
    [clef.note, transitions_to].join
  end

  CLEF_ORDER = %w[
    g1
    g2
    g3
    c1
    g4
    c2
    g5
    c3
    f1
    g28
    c4
    f2
    c5
    d1
    f3
    d2
    f4
    d3
    f5
    d4
    d5
    x1
    x2
    x3
    x4
    x5
    org
    bc
    lut
  ].freeze
end
