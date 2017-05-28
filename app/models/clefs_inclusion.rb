class ClefsInclusion < ActiveRecord::Base
  belongs_to :inclusion, inverse_of: :clefs_inclusions
  belongs_to :clef, inverse_of: :clefs_inclusions

  def annotated_note
    return "" if clef.nil?

    annotated = clef.note
    annotated = "[#{annotated}]" if missing?
    annotated = "(#{annotated})" if partial?

    return annotated
  end

  def annotated_note=(annotated)
    if annotated =~ /^(\()?(\[)?(\w+)/
      self.partial = $1.present?
      self.missing = $2.present?
      self.clef = Clef.find_or_initialize_by(note: $3)
    end
  end
end
