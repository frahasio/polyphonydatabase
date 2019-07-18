class ClefCombination < ApplicationRecord
  has_many :inclusions
  has_and_belongs_to_many :voicings

  before_validation :update_sorting

  def self.from_display(annotated_notes)
    return nil if annotated_notes.reject(&:blank?).empty?

    missing_ids = []
    incomplete_ids = []
    both_ids = []
    transitions_to = {}

    clefs = annotated_notes.map { |annotated_note|
      if (note_info = parse_annotations(annotated_note))
        clef = Clef.find_or_create_by(note_info.slice(:note, :optional))

        if note_info[:missing] && note_info[:incomplete]
          both_ids << clef.id
        else
          missing_ids << clef.id if note_info[:missing]
          incomplete_ids << clef.id if note_info[:incomplete]
        end

        transitions_to[clef.id] = note_info[:transition]

        clef
      end
    }

    clef_ids = clefs.compact.map(&:id).compact
    combination = self.where("sort(clef_ids) = sort('{?}')", clef_ids).first || self.create!(clef_ids: clef_ids.sort)

    {
      combination: combination,
      missing_ids: missing_ids,
      incomplete_ids: incomplete_ids,
      both_ids: both_ids,
      transitions_to: transitions_to,
    }
  end

  def to_display(missing_ids, incomplete_ids, both_ids, transitions_to)
    sorted_clefs.map { |clef|
      annotated = [clef.note, transitions_to[clef.id.to_s]].compact.join("/")
      annotated = "(#{annotated})" if clef.optional?

      if both_ids.include?(clef.id)
        annotated = "[{#{annotated}}]"
        both_ids.delete_at(both_ids.index(clef.id))
      elsif incomplete_ids.include?(clef.id)
        annotated = "{#{annotated}}"
        incomplete_ids.delete_at(incomplete_ids.index(clef.id))
      elsif missing_ids.include?(clef.id)
        annotated = "[#{annotated}]"
        missing_ids.delete_at(missing_ids.index(clef.id))
      end

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

  def clefs
    clef_ids.map {|id| Clef.cached_clefs[id] }
  end

  private

  CLEF_ORDER = %w[
    g1
    g2
    g3
    c1
    g4
    c2
    g5
    c3
    y1
    f1
    g28
    c4
    y2
    f2
    c5
    d1
    y3
    f3
    d2
    y4
    f4
    d3
    y5
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

  def self.parse_annotations(annotated_note)
    if annotated_note =~ %r|^(\[)?({)?(\()?(\w+)/?(\w+)?|
      {
        missing: $1.present?,
        incomplete: $2.present?,
        optional: $3.present?,
        note: $4,
        transition: $5,
      }
    end
  end

  def update_sorting
    self.sorting = sorted_clefs.map(&:note).join
  end
end
