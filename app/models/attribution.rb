class Attribution < ActiveRecord::Base
  belongs_to :inclusion, inverse_of: :attributions
  belongs_to :alias, inverse_of: :attributions, optional: true
  belongs_to :composer, inverse_of: :attributions, optional: true
  belongs_to :anonym, inverse_of: :attributions, optional: true
  accepts_nested_attributes_for :anonym

  def name
    composer&.name || anonym&.name || self.alias&.composer&.name
  end

  def self.set_by_names(inclusion, names)
    names.each do |name|
      if !inclusion.attributions.any? { |a| a.anonym&.name == name }
        attrib = inclusion.attributions.build
        attrib.anonym = Anonym.new(name: name)
      end
    end

    inclusion.attributions.each do |attrib|
      if !names.include?(attrib.name)
        attrib.destroy
      end
    end
  end
end
