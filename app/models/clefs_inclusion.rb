class ClefsInclusion < ActiveRecord::Base
  belongs_to :inclusion, inverse_of: :clefs_inclusions
  belongs_to :clef, inverse_of: :clefs_inclusions

  def self.sort(objects)
    sortable, blank = objects.partition(&:persisted?)
    has_clef, missing_clef = sortable.partition(&:clef)

    hash_object = has_clef.each_with_object(Hash.new {|h, k| h[k] = []}) do |obj, hash|
      hash[obj.clef.note] << obj
    end

    sorted = CLEF_ORDER.map { |note| hash_object[note] }.flatten.compact

    return sorted + missing_clef + blank
  end

  def annotated_note
    return "" if clef.nil?

    annotated = [clef.note, transitions_to].reject(&:blank?).join("/")
    annotated = "[#{annotated}]" if missing?
    annotated = "(#{annotated})" if partial?

    return annotated
  end

  def annotated_note=(annotated)
    if annotated.blank?
      self.mark_for_destruction
    elsif annotated =~ %r{^(\()?(\[)?(\w+)(?:/(\w+))?}
      self.partial = $1.present?
      self.missing = $2.present?
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
