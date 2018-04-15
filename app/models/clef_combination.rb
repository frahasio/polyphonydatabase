class ClefCombination < ApplicationRecord
  has_many :inclusions
  has_and_belongs_to_many :voicings

  def self.from_display(annotated_notes)
    missing_ids = []
    incomplete_ids = []
    transitions_to = {}

    clefs = annotated_notes.map { |annotated_note|
      if annotated_note =~ %r|^(\[)?({)?(\()?(\w+)/?(\w+)?|
        missing = $1.present?
        incomplete = $2.present?
        optional = $3.present?
        note = $4
        transition = $5

        clef = Clef.find_or_create_by(note: note, optional: optional)
        missing_ids << clef.id if missing
        incomplete_ids << clef.id if incomplete
        transitions_to[clef.id] = transition

        clef
      end
    }

    clef_ids = clefs.compact.map(&:id)
    combination = self.where("sort(clef_ids) = sort('{?}')", clef_ids).first || self.create!(clef_ids: clef_ids.sort)

    {
      combination: combination,
      missing_ids: missing_ids,
      incomplete_ids: incomplete_ids,
      transitions_to: transitions_to,
    }
  end

  def to_display(missing_ids, incomplete_ids, transitions_to)
    sorted_clefs.map { |clef|
      annotated = [clef.note, transitions_to[clef.id.to_s]].compact.join("/")
      annotated = "(#{annotated})" if clef.optional?
      annotated = "{#{annotated}}" if incomplete_ids.include?(clef.id)
      annotated = "[#{annotated}]" if missing_ids.include?(clef.id)

      annotated
    }
  end


  def sorted_clefs
    hash_object = clefs.each_with_object(Hash.new {|h, k| h[k] = []}) do |clef, hash|
      hash[clef.note] << clef
      hash[clef.note].sort_by! {|clef| clef.optional? ? 1 : 0 }
    end

    sorted = CLEF_ORDER.map { |note| hash_object[note] }.flatten.compact

    unsortable = clefs - sorted

    return sorted + unsortable
  end

  private

  def clefs
    clef_objects = Clef.find(clef_ids)
    clef_ids.map {|id| clef_objects.find {|co| co.id == id } }
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
